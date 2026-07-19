import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import { activateWorkflowPollers } from '../utils/triggerActivation';

/**
 * Draft vs. published workflow versions, rollback, and a diff endpoint.
 *
 * Model: every save creates a new row in WorkflowVersion (status='draft').
 * Publishing copies a chosen draft version's nodes/edges onto the
 * Workflow's publishedNodesJson/publishedEdgesJson and marks that version
 * 'published' — this is what the execution engine and webhook trigger
 * should read for live runs, while the editor keeps working against the
 * mutable draft. Rollback just re-publishes an older version's snapshot.
 */
export const workflowVersionsRouter = Router();
workflowVersionsRouter.use(requireAuth);

async function assertOwnership(workflowId: string, userId: string) {
  const result = await pool.query(`SELECT id FROM "Workflow" WHERE id = $1 AND "userId" = $2`, [workflowId, userId]);
  if (result.rows.length === 0) {
    const err = new Error('workflow not found') as Error & { status?: number };
    err.status = 404;
    throw err;
  }
}

async function publishVersion(workflowId: string, version: number, userId: string): Promise<void> {
  await assertOwnership(workflowId, userId);
  const versionRow = await pool.query(
    `SELECT * FROM "WorkflowVersion" WHERE "workflowId" = $1 AND version = $2`,
    [workflowId, version]
  );
  if (versionRow.rows.length === 0) {
    const err = new Error('version not found') as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  const { nodesJson, edgesJson } = versionRow.rows[0];

  await pool.query(
    `UPDATE "Workflow" SET "publishedNodesJson" = $2, "publishedEdgesJson" = $3, "publishedVersion" = $4, "isActive" = true
     WHERE id = $1`,
    [workflowId, JSON.stringify(nodesJson), JSON.stringify(edgesJson), version]
  );
  await pool.query(
    `UPDATE "WorkflowVersion" SET status = 'draft' WHERE "workflowId" = $1 AND status = 'published'`,
    [workflowId]
  );
  await pool.query(
    `UPDATE "WorkflowVersion" SET status = 'published' WHERE "workflowId" = $1 AND version = $2`,
    [workflowId, version]
  );
  // Publishing sets isActive=true above, and node params (feed URL, MQTT
  // topic, watched path, etc.) may have changed in this version — restart
  // any poller-based triggers so they pick up the new config immediately
  // rather than on the next explicit activate toggle.
  await activateWorkflowPollers(workflowId, userId).catch((err) =>
    console.error(`Failed to (re)activate poller-based triggers for workflow ${workflowId} after publish:`, err instanceof Error ? err.message : err)
  );
}

const saveSchema = z.object({
  nodesJson: z.unknown(),
  edgesJson: z.unknown(),
  message: z.string().optional(),
});

/** POST /workflows/:id/versions — save current editor state as a new draft version. */
workflowVersionsRouter.post('/:id/versions', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const workflowId = req.params.id;
    await assertOwnership(workflowId, userId);
    const { nodesJson, edgesJson, message } = saveSchema.parse(req.body);

    const nextVersionResult = await pool.query(
      `UPDATE "Workflow" SET "draftVersion" = "draftVersion" + 1, "nodesJson" = $2, "edgesJson" = $3, "updatedAt" = now()
       WHERE id = $1 RETURNING "draftVersion"`,
      [workflowId, JSON.stringify(nodesJson), JSON.stringify(edgesJson)]
    );
    const version = nextVersionResult.rows[0].draftVersion as number;

    const inserted = await pool.query(
      `INSERT INTO "WorkflowVersion" (id, "workflowId", version, status, "nodesJson", "edgesJson", message, "createdBy")
       VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7) RETURNING *`,
      [randomUUID(), workflowId, version, JSON.stringify(nodesJson), JSON.stringify(edgesJson), message ?? null, userId]
    );
    res.status(201).json(inserted.rows[0]);
  } catch (err) {
    next(err);
  }
});

/** GET /workflows/:id/versions — list all saved versions (draft + published), newest first. */
workflowVersionsRouter.get('/:id/versions', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const workflowId = req.params.id;
    await assertOwnership(workflowId, userId);
    const result = await pool.query(
      `SELECT id, version, status, message, "createdBy", "createdAt" FROM "WorkflowVersion"
       WHERE "workflowId" = $1 ORDER BY version DESC`,
      [workflowId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

/** POST /workflows/:id/versions/:version/publish — make this version the live one. */
workflowVersionsRouter.post('/:id/versions/:version/publish', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const workflowId = req.params.id;
    const version = Number(req.params.version);
    await publishVersion(workflowId, version, userId);
    res.json({ published: true, version });
  } catch (err) {
    next(err);
  }
});

/** POST /workflows/:id/versions/:version/rollback — alias for publish, semantically "go back to". */
workflowVersionsRouter.post('/:id/versions/:version/rollback', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const workflowId = req.params.id;
    const version = Number(req.params.version);
    await publishVersion(workflowId, version, userId);
    res.json({ rolledBack: true, version });
  } catch (err) {
    next(err);
  }
});

/** GET /workflows/:id/versions/diff?from=1&to=3 — structural diff between two versions. */
workflowVersionsRouter.get('/:id/versions/diff', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const workflowId = req.params.id;
    await assertOwnership(workflowId, userId);
    const from = Number(req.query.from);
    const to = Number(req.query.to);

    const rows = await pool.query(
      `SELECT version, "nodesJson", "edgesJson" FROM "WorkflowVersion" WHERE "workflowId" = $1 AND version IN ($2, $3)`,
      [workflowId, from, to]
    );
    const fromRow = rows.rows.find((r: any) => r.version === from);
    const toRow = rows.rows.find((r: any) => r.version === to);
    if (!fromRow || !toRow) return res.status(404).json({ error: 'one or both versions not found' });

    res.json({
      from,
      to,
      nodes: diffById(fromRow.nodesJson as Array<{ id: string }>, toRow.nodesJson as Array<{ id: string }>),
      edges: diffById(fromRow.edgesJson as Array<{ id: string }>, toRow.edgesJson as Array<{ id: string }>),
    });
  } catch (err) {
    next(err);
  }
});

/** Simple id-keyed add/remove/change diff — good enough for a workflow diff viewer UI. */
function diffById(fromItems: Array<{ id: string }>, toItems: Array<{ id: string }>) {
  const fromMap = new Map(fromItems.map((i) => [i.id, i]));
  const toMap = new Map(toItems.map((i) => [i.id, i]));
  const added = toItems.filter((i) => !fromMap.has(i.id));
  const removed = fromItems.filter((i) => !toMap.has(i.id));
  const changed = toItems.filter((i) => {
    const prev = fromMap.get(i.id);
    return prev && JSON.stringify(prev) !== JSON.stringify(i);
  });
  return { added, removed, changed };
}
