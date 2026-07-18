import { pool } from './pool';
import { randomUUID } from 'crypto';

export interface Workflow {
  id: string;
  userId: string;
  name: string;
  nodesJson: unknown;
  edgesJson: unknown;
  isActive: boolean;
  workspaceId: string | null;
  folderId: string | null;
  errorWorkflowId: string | null;
  lastManualTestPayload: unknown;
  maxConcurrency: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function createWorkflow(
  userId: string,
  name: string,
  nodesJson: unknown,
  edgesJson: unknown,
  workspaceId?: string | null,
  folderId?: string | null
): Promise<Workflow> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "Workflow" (id, "userId", name, "nodesJson", "edgesJson", "isActive", "workspaceId", "folderId", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, false, $6, $7, now())
     RETURNING *`,
    [id, userId, name, JSON.stringify(nodesJson), JSON.stringify(edgesJson), workspaceId ?? null, folderId ?? null]
  );
  return result.rows[0];
}

/** Workflows owned by the user directly, OR belonging to any workspace they're a member of. */
export async function listWorkflows(userId: string, workspaceId?: string): Promise<Workflow[]> {
  if (workspaceId) {
    const result = await pool.query(
      `SELECT wf.* FROM "Workflow" wf
       JOIN "WorkspaceMember" m ON m."workspaceId" = wf."workspaceId" AND m."userId" = $2
       WHERE wf."workspaceId" = $1 ORDER BY wf."createdAt" DESC`,
      [workspaceId, userId]
    );
    return result.rows;
  }
  const result = await pool.query(
    `SELECT DISTINCT wf.* FROM "Workflow" wf
     LEFT JOIN "WorkspaceMember" m ON m."workspaceId" = wf."workspaceId" AND m."userId" = $1
     LEFT JOIN "WorkflowShare" ws ON ws."workflowId" = wf.id AND ws."sharedWithUserId" = $1
     WHERE wf."userId" = $1 OR m."userId" = $1 OR ws."sharedWithUserId" = $1
     ORDER BY wf."createdAt" DESC`,
    [userId]
  );
  return result.rows;
}

/** Fetches a workflow if the user owns it directly or belongs to its workspace (any role). */
export async function getWorkflowById(id: string, userId: string): Promise<Workflow | null> {
  const result = await pool.query(
    `SELECT wf.* FROM "Workflow" wf
     LEFT JOIN "WorkspaceMember" m ON m."workspaceId" = wf."workspaceId" AND m."userId" = $2
     LEFT JOIN "WorkflowShare" ws ON ws."workflowId" = wf.id AND ws."sharedWithUserId" = $2
     WHERE wf.id = $1 AND (wf."userId" = $2 OR m."userId" = $2 OR ws."sharedWithUserId" = $2)`,
    [id, userId]
  );
  return result.rows[0] ?? null;
}

/** Fetches a workflow with no ownership/membership check — only use after a permission check (e.g. requireWorkflowRole) has already run. */
export async function getWorkflowByIdUnsafe(id: string): Promise<Workflow | null> {
  const result = await pool.query(`SELECT * FROM "Workflow" WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function updateWorkflow(
  id: string,
  userId: string,
  fields: Partial<
    Pick<
      Workflow,
      'name' | 'nodesJson' | 'edgesJson' | 'isActive' | 'folderId' | 'errorWorkflowId' | 'lastManualTestPayload' | 'maxConcurrency'
    >
  >
): Promise<Workflow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(fields.name);
  }
  if (fields.nodesJson !== undefined) {
    sets.push(`"nodesJson" = $${idx++}`);
    values.push(JSON.stringify(fields.nodesJson));
  }
  if (fields.edgesJson !== undefined) {
    sets.push(`"edgesJson" = $${idx++}`);
    values.push(JSON.stringify(fields.edgesJson));
  }
  if (fields.isActive !== undefined) {
    sets.push(`"isActive" = $${idx++}`);
    values.push(fields.isActive);
  }
  if (fields.folderId !== undefined) {
    sets.push(`"folderId" = $${idx++}`);
    values.push(fields.folderId);
  }
  if (fields.errorWorkflowId !== undefined) {
    sets.push(`"errorWorkflowId" = $${idx++}`);
    values.push(fields.errorWorkflowId);
  }
  if (fields.lastManualTestPayload !== undefined) {
    sets.push(`"lastManualTestPayload" = $${idx++}`);
    values.push(JSON.stringify(fields.lastManualTestPayload));
  }
  if (fields.maxConcurrency !== undefined) {
    sets.push(`"maxConcurrency" = $${idx++}`);
    values.push(fields.maxConcurrency);
  }
  sets.push(`"updatedAt" = now()`);

  if (sets.length === 1) {
    return getWorkflowById(id, userId);
  }

  // Access check: owner or any workspace member with this id may update (role gating
  // for *which* fields happens in the route layer via requireWorkflowRole).
  values.push(id, userId);
  const result = await pool.query(
    `UPDATE "Workflow" SET ${sets.join(', ')}
     WHERE id = $${idx++} AND (
       "userId" = $${idx}
       OR "workspaceId" IN (SELECT "workspaceId" FROM "WorkspaceMember" WHERE "userId" = $${idx})
       OR id IN (SELECT "workflowId" FROM "WorkflowShare" WHERE "sharedWithUserId" = $${idx} AND role IN ('editor', 'admin'))
     )
     RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteWorkflow(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM "Workflow" WHERE id = $1 AND (
       "userId" = $2
       OR "workspaceId" IN (SELECT "workspaceId" FROM "WorkspaceMember" WHERE "userId" = $2 AND role IN ('owner','admin'))
       OR id IN (SELECT "workflowId" FROM "WorkflowShare" WHERE "sharedWithUserId" = $2 AND role = 'admin')
     )`,
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Workflow-level sharing / ownership transfer
// ---------------------------------------------------------------------------

export type WorkflowShareRole = 'viewer' | 'editor' | 'admin';

export interface WorkflowShareRecord {
  id: string;
  workflowId: string;
  sharedWithUserId: string;
  sharedWithEmail: string;
  role: WorkflowShareRole;
  createdAt: Date;
}

export async function listWorkflowShares(workflowId: string): Promise<WorkflowShareRecord[]> {
  const result = await pool.query(
    `SELECT ws.id, ws."workflowId", ws."sharedWithUserId", u.email AS "sharedWithEmail",
            ws.role, ws."createdAt"
     FROM "WorkflowShare" ws
     JOIN "User" u ON u.id = ws."sharedWithUserId"
     WHERE ws."workflowId" = $1
     ORDER BY ws."createdAt" ASC`,
    [workflowId]
  );
  return result.rows;
}

export async function shareWorkflow(
  workflowId: string,
  sharedWithUserId: string,
  role: WorkflowShareRole
): Promise<WorkflowShareRecord> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "WorkflowShare" (id, "workflowId", "sharedWithUserId", role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ("workflowId", "sharedWithUserId") DO UPDATE SET role = EXCLUDED.role
     RETURNING id, "workflowId", "sharedWithUserId", role, "createdAt"`,
    [id, workflowId, sharedWithUserId, role]
  );
  const row = result.rows[0];
  const userResult = await pool.query(`SELECT email FROM "User" WHERE id = $1`, [sharedWithUserId]);
  return { ...row, sharedWithEmail: userResult.rows[0]?.email ?? '' };
}

export async function unshareWorkflow(workflowId: string, sharedWithUserId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM "WorkflowShare" WHERE "workflowId" = $1 AND "sharedWithUserId" = $2`,
    [workflowId, sharedWithUserId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Transfers real ownership (the Workflow.userId column) to another user.
 * The previous owner is downgraded to an 'admin' WorkflowShare so they
 * don't lose access outright — mirrors n8n's "transfer ownership" flow,
 * which keeps the original owner as a project member afterward.
 */
export async function transferWorkflowOwnership(
  workflowId: string,
  currentOwnerId: string,
  newOwnerId: string
): Promise<Workflow | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE "Workflow" SET "userId" = $2 WHERE id = $1 AND "userId" = $3 RETURNING *`,
      [workflowId, newOwnerId, currentOwnerId]
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      `INSERT INTO "WorkflowShare" (id, "workflowId", "sharedWithUserId", role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT ("workflowId", "sharedWithUserId") DO UPDATE SET role = 'admin'`,
      [randomUUID(), workflowId, currentOwnerId]
    );
    // The new owner no longer needs a share row now that they're the real owner.
    await client.query(`DELETE FROM "WorkflowShare" WHERE "workflowId" = $1 AND "sharedWithUserId" = $2`, [
      workflowId,
      newOwnerId,
    ]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
